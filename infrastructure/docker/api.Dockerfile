FROM python:3.12-slim
WORKDIR /app
COPY apps/solver /solver
RUN pip install --no-cache-dir /solver
COPY apps/api /api
RUN pip install --no-cache-dir "/api[aws]"
COPY config/contracts /app/config/contracts
COPY config/staging /app/config/staging
COPY scripts/aws/api-entrypoint.py /app/api-entrypoint.py
ARG DATABASE_CA_URL=""
RUN if [ -n "$DATABASE_CA_URL" ]; then DATABASE_CA_URL="$DATABASE_CA_URL" python -c "import os,urllib.request; urllib.request.urlretrieve(os.environ['DATABASE_CA_URL'], '/etc/ssl/certs/rds-global-bundle.pem')"; fi
RUN chmod -R a+rX /app/config
USER 65532:65532
CMD ["uvicorn", "eventclear_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
