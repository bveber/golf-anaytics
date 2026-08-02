# Self-signed certificate for the Lambda-gateway-to-EC2 hop only. Browsers
# never see this cert (they see the real ACM cert at the API Gateway custom
# domain) - it exists purely so the gateway Lambda can authenticate the
# specific EC2 instance it just started, without relying on Caddy obtaining
# its own public Let's Encrypt cert. Caddy can never do that here: ACME
# HTTP-01/TLS-ALPN-01 challenges must be reachable at the domain's public DNS
# answer, which points at API Gateway (so the domain survives the EC2
# instance's IP changing on every stop/start), not at the EC2 instance
# itself - so Caddy's automatic HTTPS would retry forever and never succeed.
resource "tls_private_key" "origin" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "origin" {
  private_key_pem = tls_private_key.origin.private_key_pem

  subject {
    common_name = var.domain_name
  }

  dns_names             = [var.domain_name]
  validity_period_hours = 87600 # 10 years
  allowed_uses          = ["key_encipherment", "digital_signature", "server_auth"]
}

resource "aws_ssm_parameter" "origin_cert" {
  name  = "/golf-analytics/origin-cert"
  type  = "String"
  value = tls_self_signed_cert.origin.cert_pem
}

resource "aws_ssm_parameter" "origin_key" {
  name  = "/golf-analytics/origin-key"
  type  = "SecureString"
  value = tls_private_key.origin.private_key_pem
}
