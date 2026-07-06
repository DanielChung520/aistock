"""Setup SeaweedFS bucket and directory prefixes for aistock-market-data.

Idempotent — safe to run multiple times.
"""

import logging
import sys

import boto3
from botocore.exceptions import ClientError

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from src.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("setup_seaweedfs")


def get_s3_client() -> boto3.client:
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.SEAWEEDFS_ENDPOINT,
        aws_access_key_id=settings.SEAWEEDFS_ACCESS_KEY,
        aws_secret_access_key=settings.SEAWEEDFS_SECRET_KEY,
        region_name="us-east-1",
    )


def setup_bucket() -> None:
    settings = get_settings()
    s3 = get_s3_client()
    bucket = settings.SEAWEEDFS_BUCKET

    try:
        s3.head_bucket(Bucket=bucket)
        logger.info("Bucket '%s' already exists", bucket)
    except ClientError:
        s3.create_bucket(Bucket=bucket)
        logger.info("Created bucket '%s'", bucket)

    for prefix in ("daily/", "minute/", "analysis/"):
        key = f"{prefix}.keep"
        try:
            s3.head_object(Bucket=bucket, Key=key)
            logger.info("Prefix '%s' already exists", prefix)
        except ClientError:
            s3.put_object(Bucket=bucket, Key=key, Body=b"")
            logger.info("Created prefix '%s'", prefix)

    logger.info("SeaweedFS setup complete for bucket '%s'", bucket)


if __name__ == "__main__":
    setup_bucket()
