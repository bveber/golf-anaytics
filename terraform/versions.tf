terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "s3" {
    bucket         = "golf-analytics-tfstate-631232331576"
    key            = "golf-analytics/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "golf-analytics-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certs for an ALB must be requested in the ALB's own region, which is
# already us-east-1 here, so no provider alias is needed for that.
