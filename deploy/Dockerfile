FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY frontend frontend
COPY deploy/start.sh /srv/start.sh
RUN chmod +x /srv/start.sh && mkdir -p /srv/data && chown app /srv/data
WORKDIR /srv/backend
USER app
ENV HAEM5_DB_URL=sqlite:////srv/data/haem5.db
EXPOSE 8000
CMD ["/srv/start.sh"]
