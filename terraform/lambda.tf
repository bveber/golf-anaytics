data "archive_file" "gateway" {
  type        = "zip"
  source_file = "${path.module}/lambda_functions/gateway.py"
  output_path = "${path.module}/.build/gateway.zip"
}

resource "aws_lambda_function" "gateway" {
  function_name    = "golf-analytics-gateway"
  role             = aws_iam_role.gateway_lambda.arn
  handler          = "gateway.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.gateway.output_path
  source_code_hash = data.archive_file.gateway.output_base64sha256
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      INSTANCE_ID = aws_instance.app.id
      DOMAIN      = var.domain_name
    }
  }
}

resource "aws_lambda_permission" "gateway_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gateway.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

data "archive_file" "reaper" {
  type        = "zip"
  source_file = "${path.module}/lambda_functions/reaper.py"
  output_path = "${path.module}/.build/reaper.zip"
}

resource "aws_lambda_function" "reaper" {
  function_name    = "golf-analytics-reaper"
  role             = aws_iam_role.reaper_lambda.arn
  handler          = "reaper.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.reaper.output_path
  source_code_hash = data.archive_file.reaper.output_base64sha256
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      INSTANCE_ID  = aws_instance.app.id
      IDLE_MINUTES = "30"
    }
  }
}

resource "aws_cloudwatch_event_rule" "reaper_schedule" {
  name                = "golf-analytics-reaper-schedule"
  schedule_expression = "rate(10 minutes)"
}

resource "aws_cloudwatch_event_target" "reaper" {
  rule = aws_cloudwatch_event_rule.reaper_schedule.name
  arn  = aws_lambda_function.reaper.arn
}

resource "aws_lambda_permission" "reaper_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reaper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reaper_schedule.arn
}
