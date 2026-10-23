# Staging monitoring evidence

Status: **NOT ACTIVATED OR TESTED REMOTELY**

CloudWatch/SNS infrastructure and embedded-metric definitions are implemented,
but no remote dashboard, alarm or delivery was created or verified in this
sprint. Definitions and successful API submission are not delivery evidence.

After provisioning, confirm the real SNS subscription and run the protected
`monitoring-check` action. Download its sanitized trigger record. Only after
receiving the actual notification use `scripts/aws/confirm-monitoring.mjs` with
the real receipt reference and UTC receive timestamp. Retain both alarm trigger
and recovery timestamps plus the recipient confirmation in the evidence PR.
