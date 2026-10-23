"""CloudWatch embedded metrics for controlled staging. No request or secret payloads."""

import json
import os
import time


def emit(**metrics):
    if os.getenv("EVENTCLEAR_MODE") != "staging":
        return
    stack = os.getenv("STAGING_STACK_NAME")
    if not stack:
        raise RuntimeError("STAGING_METRIC_DIMENSION_REQUIRED")
    print(
        json.dumps(
            {
                "_aws": {
                    "Timestamp": int(time.time() * 1000),
                    "CloudWatchMetrics": [
                        {
                            "Namespace": "EventClear/Staging",
                            "Dimensions": [["Stack"]],
                            "Metrics": [
                                {
                                    "Name": name,
                                    "Unit": "Milliseconds"
                                    if name == "ApiLatency"
                                    else "Count",
                                }
                                for name in metrics
                            ],
                        }
                    ],
                },
                "Stack": stack,
                **metrics,
            }
        ),
        flush=True,
    )
