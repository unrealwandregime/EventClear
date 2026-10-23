"""Verify a real S3 artifact and conditional immutability without logging its URL."""

import hashlib
import json
import os
import sys
import boto3
from botocore.exceptions import ClientError

record = json.load(sys.stdin)
client = boto3.client("s3", region_name=os.environ["AWS_REGION"])
bucket = record["bucket"]
key = record["key"]
response = client.get_object(Bucket=bucket, Key=key)
body = response["Body"].read()
assert "0x" + hashlib.sha256(body).hexdigest() == record["sha256"]
assert response.get("VersionId")
try:
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=b"conflicting overwrite must fail",
        IfNoneMatch="*",
        ServerSideEncryption="AES256",
    )
except ClientError as error:
    assert error.response["ResponseMetadata"]["HTTPStatusCode"] == 412
else:
    raise RuntimeError("S3_IMMUTABILITY_FAILED")
print("S3 artifact version, hash, and conflicting-overwrite rejection verified.")
