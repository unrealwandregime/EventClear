FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir psycopg[binary]==3.2.9
COPY infrastructure/docker/postgres/migrations /migrations
COPY scripts/aws/migrate.py /app/migrate.py
ARG DATABASE_CA_URL=""
RUN if [ -n "$DATABASE_CA_URL" ]; then DATABASE_CA_URL="$DATABASE_CA_URL" python -c "import os,urllib.request; urllib.request.urlretrieve(os.environ['DATABASE_CA_URL'], '/etc/ssl/certs/rds-global-bundle.pem')"; fi
USER 65532:65532
CMD ["python", "/app/migrate.py"]
