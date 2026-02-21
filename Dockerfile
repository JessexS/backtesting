FROM node:20-alpine

LABEL maintainer="backtesting"
LABEL description="Browser-based backtesting engine with CLI support"

WORKDIR /app

# Copy application files
COPY . .

# Install a lightweight static file server
RUN npm init -y && npm install serve --save

# Expose port for the web UI
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost:8000/ || exit 1

# Default: serve the web UI
CMD ["npx", "serve", "-s", ".", "-l", "8000"]
