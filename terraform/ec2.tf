resource "aws_security_group" "ec2" {
  name        = "golf-analytics-ec2"
  description = "App instance - HTTPS/HTTP reachable directly (gateway Lambda has no fixed IP range to scope to)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTPS - Caddy, also what the gateway Lambda proxies to"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP - Lets Encrypt ACME HTTP-01 challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.ssh_allowed_cidr != "" ? [1] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [var.ssh_allowed_cidr]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = local.ec2_subnet_id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = var.key_pair_name != "" ? var.key_pair_name : null

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = base64encode(templatefile("${path.module}/user_data.sh.tpl", {
    github_repo = var.github_repo
  }))

  # Persistent volumes (db/, backups/, .cookies/) live in /opt/golf-analytics on
  # the root volume - replacing the instance would lose them, so re-provisioning
  # only touches user_data (re-run manually via SSM if ever needed), not a
  # forced instance replacement.
  lifecycle {
    ignore_changes = [ami, user_data]
  }

  tags = {
    Name = "golf-analytics-app"
  }
}

output "ec2_instance_id" {
  value = aws_instance.app.id
}
