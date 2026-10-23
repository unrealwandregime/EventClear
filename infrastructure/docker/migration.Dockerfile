FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir psycopg[binary]==3.2.9
COPY infrastructure/docker/postgres/migrations /migrations
COPY scripts/aws/migrate.py /app/migrate.py
RUN python -c "import urllib.request; urllib.request.urlretrieve('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', '/etc/ssl/certs/rds-global-bundle.pem')"
USER 65532:65532
CMD ["python", "/app/migrate.py"]
