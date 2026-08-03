# --- EC2 instance role (already created via CLI, imported into state) ---

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "golf-analytics-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

data "aws_iam_policy_document" "ec2_app_policy" {
  statement {
    sid    = "RcloudCredsParams"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:PutParameter",
      "ssm:DeleteParameter",
    ]
    resources = ["arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/golf-analytics/rcloud-creds/*"]
  }

  statement {
    sid       = "AppEnvParam"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/golf-analytics/app-env"]
  }

  statement {
    sid     = "OriginCertParams"
    effect  = "Allow"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/golf-analytics/origin-cert",
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/golf-analytics/origin-key",
    ]
  }

  statement {
    sid       = "BackupsBucket"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "ec2_app_policy" {
  name   = "golf-analytics-app-policy"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_app_policy.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "golf-analytics-ec2-profile"
  role = aws_iam_role.ec2.name
}

# Required for SSM Session Manager access (debugging) and the GitHub Actions
# deploy workflow's `aws ssm send-command` calls to reach the instance.
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# --- Gateway Lambda role: wakes the instance and proxies requests to it ---

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "gateway_lambda" {
  name               = "golf-analytics-gateway-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "gateway_lambda_policy" {
  statement {
    effect    = "Allow"
    actions   = ["ec2:DescribeInstances", "ec2:StartInstances"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gateway_lambda_policy" {
  name   = "golf-analytics-gateway-lambda-policy"
  role   = aws_iam_role.gateway_lambda.id
  policy = data.aws_iam_policy_document.gateway_lambda_policy.json
}

# --- Reaper Lambda role: stops the instance after idle ---

resource "aws_iam_role" "reaper_lambda" {
  name               = "golf-analytics-reaper-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "reaper_lambda_policy" {
  statement {
    effect    = "Allow"
    actions   = ["ec2:DescribeInstances", "ec2:StopInstances"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["cloudwatch:GetMetricStatistics"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "reaper_lambda_policy" {
  name   = "golf-analytics-reaper-lambda-policy"
  role   = aws_iam_role.reaper_lambda.id
  policy = data.aws_iam_policy_document.reaper_lambda_policy.json
}

# --- GitHub Actions OIDC federation (no stored AWS keys) ---

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      # Pushes to main (deploy/apply workflows) plus pull_request-triggered
      # runs (the plan-on-PR check) - pull_request's sub claim isn't tied to
      # a specific branch or PR number, just "pull_request" itself.
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "golf-analytics-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json
}

# Deploy permissions: run Terraform (broad within this app's resource set) and
# trigger deploys via SSM Send-Command against the app instance.
data "aws_iam_policy_document" "github_actions_policy" {
  statement {
    sid    = "TerraformState"
    effect = "Allow"
    actions = [
      "s3:GetObject", "s3:PutObject", "s3:ListBucket",
    ]
    resources = [
      "arn:aws:s3:::golf-analytics-tfstate-631232331576",
      "arn:aws:s3:::golf-analytics-tfstate-631232331576/*",
    ]
  }

  statement {
    sid       = "TerraformLock"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/golf-analytics-tfstate-lock"]
  }

  statement {
    sid    = "SSMDeploy"
    effect = "Allow"
    actions = [
      "ssm:SendCommand",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:StartAutomationExecution",
      "ssm:GetAutomationExecution",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "OriginCertParams"
    effect = "Allow"
    actions = [
      "ssm:PutParameter",
      "ssm:GetParameter",
      "ssm:DeleteParameter",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/golf-analytics/origin-cert",
      "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/golf-analytics/origin-key",
    ]
  }

  statement {
    sid       = "WakeInstanceForDeploy"
    effect    = "Allow"
    actions   = ["ec2:StartInstances", "ec2:DescribeInstances"]
    resources = ["*"]
  }

  # Broad infra permissions scoped to managing this app's own resources via
  # Terraform. At this project's scale, resource-level scoping every action
  # below adds a lot of policy complexity for one small app; tightened further
  # if this ever manages more than a single app's infra.
  statement {
    sid    = "InfraManagement"
    effect = "Allow"
    actions = [
      "ec2:*",
      "route53:*",
      "acm:*",
      "lambda:*",
      "apigateway:*",
      "events:*",
      "logs:*",
      "iam:GetRole", "iam:PassRole", "iam:GetInstanceProfile",
      "iam:CreateRole", "iam:DeleteRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
      "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:GetOpenIDConnectProvider", "iam:TagRole",
      "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy", "iam:ListPolicyVersions",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
    ]
    resources = ["*"]
  }

  # DescribeParameters doesn't support resource-level scoping, so this can't
  # be narrowed to the origin-cert/origin-key params like the statement above.
  statement {
    sid       = "SSMParameterRefresh"
    effect    = "Allow"
    actions   = ["ssm:DescribeParameters"]
    resources = ["*"]
  }

  # The aws_s3_bucket resource family's refresh bundles many separate Get*
  # calls (ACL, policy, CORS, logging, tagging, object-lock, replication,
  # location, etc). If any single one gets AccessDenied, the AWS provider can
  # misread that as "bucket doesn't exist" and propose destroying and
  # recreating it - a false positive from missing IAM, not real drift. Grant
  # the full read set (still scoped to just this bucket) to avoid repeating
  # that per sub-resource.
  statement {
    sid    = "BackupsBucketConfigRefresh"
    effect = "Allow"
    actions = [
      "s3:GetBucket*",
      "s3:GetLifecycleConfiguration",
      "s3:GetEncryptionConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:GetAccelerateConfiguration",
    ]
    resources = [aws_s3_bucket.backups.arn]
  }
}

resource "aws_iam_role_policy" "github_actions_policy" {
  name   = "golf-analytics-deploy-policy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_policy.json
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}
