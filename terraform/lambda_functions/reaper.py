"""
Scheduled every ~10 minutes via EventBridge. Stops the app instance if it's
been running past a grace period with negligible network activity - no custom
"last request" tracking needed, CloudWatch already collects NetworkIn for free.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import boto3

INSTANCE_ID = os.environ["INSTANCE_ID"]
IDLE_MINUTES = int(os.environ.get("IDLE_MINUTES", "30"))
IDLE_BYTES_THRESHOLD = 50_000  # background chatter (SSM agent etc.) is far below this

ec2 = boto3.client("ec2")
cloudwatch = boto3.client("cloudwatch")


def handler(event, context):
    resp = ec2.describe_instances(InstanceIds=[INSTANCE_ID])
    instance = resp["Reservations"][0]["Instances"][0]
    if instance["State"]["Name"] != "running":
        return {"status": "not running, nothing to do"}

    now = datetime.now(timezone.utc)
    uptime_minutes = (now - instance["LaunchTime"]).total_seconds() / 60
    if uptime_minutes < IDLE_MINUTES:
        return {"status": f"only up {uptime_minutes:.0f}m, within grace period"}

    metrics = cloudwatch.get_metric_statistics(
        Namespace="AWS/EC2",
        MetricName="NetworkIn",
        Dimensions=[{"Name": "InstanceId", "Value": INSTANCE_ID}],
        StartTime=now - timedelta(minutes=IDLE_MINUTES),
        EndTime=now,
        Period=300,
        Statistics=["Sum"],
    )
    total_bytes = sum(dp["Sum"] for dp in metrics["Datapoints"])

    if total_bytes < IDLE_BYTES_THRESHOLD:
        ec2.stop_instances(InstanceIds=[INSTANCE_ID])
        return {"status": "stopped due to inactivity", "network_bytes": total_bytes}

    return {"status": "active", "network_bytes": total_bytes}
