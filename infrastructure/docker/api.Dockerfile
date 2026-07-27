FROM python:3.12-slim
WORKDIR /app
COPY apps/solver /solver
RUN pip install --no-cache-dir /solver
COPY apps/api /api
RUN pip install --no-cache-dir /api
USER 65532:65532
