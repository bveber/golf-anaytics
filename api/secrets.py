from __future__ import annotations

import json
import os

import boto3
from botocore.exceptions import ClientError

_PARAM_PREFIX = "/golf-analytics/rcloud-creds"


def _param_name(user_id: int) -> str:
    return f"{_PARAM_PREFIX}/{user_id}"


def _client():
    return boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def get_rcloud_credentials(user_id: int) -> tuple[str, str] | None:
    """Returns (email, password) for the user, or None if not configured."""
    try:
        resp = _client().get_parameter(Name=_param_name(user_id), WithDecryption=True)
    except ClientError as e:
        if e.response["Error"]["Code"] == "ParameterNotFound":
            return None
        raise
    data = json.loads(resp["Parameter"]["Value"])
    return data["email"], data["password"]


def put_rcloud_credentials(user_id: int, email: str, password: str) -> None:
    value = json.dumps({"email": email, "password": password})
    _client().put_parameter(
        Name=_param_name(user_id), Value=value, Type="SecureString", Overwrite=True
    )


def delete_rcloud_credentials(user_id: int) -> None:
    try:
        _client().delete_parameter(Name=_param_name(user_id))
    except ClientError as e:
        if e.response["Error"]["Code"] != "ParameterNotFound":
            raise
