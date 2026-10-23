FROM python:3.12-slim
WORKDIR /app
COPY apps/solver /solver
RUN pip install --no-cache-dir /solver
USER 65532:65532
CMD ["uvicorn", "eventclear_solver.main:app", "--host", "0.0.0.0", "--port", "8001"]
