"""
API Gateway front door for the app. If the EC2 instance is stopped, starts it
and returns a "waking up" page; if running, proxies the request through to it.
Stdlib-only (plus the boto3 that's preinstalled in the Lambda Python runtime)
so no dependency packaging/layers are needed.
"""

from __future__ import annotations

import base64
import http.client
import os
import socket
import ssl

import boto3

INSTANCE_ID = os.environ["INSTANCE_ID"]
DOMAIN = os.environ["DOMAIN"]
ORIGIN_CERT_PEM = os.environ["ORIGIN_CERT_PEM"]

ec2 = boto3.client("ec2")

WAKING_HTML = """<!doctype html>
<html><head><meta http-equiv="refresh" content="5">
<title>Waking up...</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 10%">
<h2>Waking up your golf stats...</h2>
<p>This takes about a minute. This page refreshes automatically.</p>
</body></html>"""


def handler(event, context):
    instance = _describe_instance()
    state = instance["State"]["Name"]

    if state == "stopped":
        ec2.start_instances(InstanceIds=[INSTANCE_ID])
        return _html_response(WAKING_HTML)
    if state != "running":
        return _html_response(WAKING_HTML)

    public_ip = instance.get("PublicIpAddress")
    if not public_ip:
        return _html_response(WAKING_HTML)

    try:
        return _proxy(event, public_ip)
    except Exception:
        return _html_response(WAKING_HTML)


def _describe_instance():
    resp = ec2.describe_instances(InstanceIds=[INSTANCE_ID])
    return resp["Reservations"][0]["Instances"][0]


def _proxy(event, public_ip):
    method = event["requestContext"]["http"]["method"]
    path = event.get("rawPath") or "/"
    query = event.get("rawQueryString", "")
    if query:
        path = f"{path}?{query}"

    headers = {k: v for k, v in event.get("headers", {}).items() if k.lower() != "host"}
    headers["Host"] = DOMAIN
    cookies = event.get("cookies")
    if cookies:
        headers["Cookie"] = "; ".join(cookies)

    body = event.get("body")
    if body and event.get("isBase64Encoded"):
        body = base64.b64decode(body)
    elif body:
        body = body.encode()

    # Connect by IP but present DOMAIN for SNI/Host. Caddy can't get a public
    # CA-trusted cert for DOMAIN here (ACME challenges must reach DOMAIN's
    # public DNS answer, which points at API Gateway, not this instance), so
    # instead of trusting the public CA chain we pin the exact self-signed
    # cert Caddy was provisioned with (see terraform/origin_cert.tf).
    ctx = ssl.create_default_context(cadata=ORIGIN_CERT_PEM)
    sock = socket.create_connection((public_ip, 443), timeout=10)
    ssock = ctx.wrap_socket(sock, server_hostname=DOMAIN)

    conn = http.client.HTTPConnection(DOMAIN)
    conn.sock = ssock
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    resp_body = resp.read()

    resp_cookies = []
    resp_headers = {}
    for k, v in resp.getheaders():
        if k.lower() == "set-cookie":
            resp_cookies.append(v)
        elif k.lower() not in ("transfer-encoding", "content-length", "connection"):
            resp_headers[k] = v
    status = resp.status
    conn.close()

    result = {
        "statusCode": status,
        "headers": resp_headers,
        "body": base64.b64encode(resp_body).decode(),
        "isBase64Encoded": True,
    }
    if resp_cookies:
        result["cookies"] = resp_cookies
    return result


def _html_response(html: str) -> dict:
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "text/html"},
        "body": html,
    }
