variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "domain_name" {
  type    = string
  default = "mygolfanalytics.com"
}

variable "account_id" {
  type    = string
  default = "631232331576"
}

variable "backups_bucket_name" {
  type    = string
  default = "golf-analytics-backups-631232331576"
}

variable "instance_type" {
  description = "Playwright/Chromium needs headroom - t3.small is the floor, t3.medium if syncs OOM."
  type        = string
  default     = "t3.small"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deploy role, as owner/repo"
  type        = string
  default     = "bveber/golf-anaytics"
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH into the instance (your own IP/32). Leave empty to disable SSH entirely."
  type        = string
  default     = ""
}

variable "key_pair_name" {
  description = "Existing EC2 key pair name for SSH access, or empty to skip SSH key assignment"
  type        = string
  default     = ""
}
