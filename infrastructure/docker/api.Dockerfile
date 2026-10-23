FROM python:3.12-slim
WORKDIR /app
COPY apps/solver /solver
RUN pip install --no-cache-dir /solver
COPY apps/api /api
RUN pip install --no-cache-dir /api
COPY config/contracts /app/config/contracts
COPY config/staging /app/config/staging
COPY scripts/aws/api-entrypoint.py /app/api-entrypoint.py
RUN python -c "import urllib.request; urllib.request.urlretrieve('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', '/etc/ssl/certs/rds-global-bundle.pem')"
RUN chmod -R a+rX /app/config
USER 65532:65532
CMD ["uvicorn", "eventclear_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
