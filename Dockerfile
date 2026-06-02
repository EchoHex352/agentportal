FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy application
COPY server/ ./server/
COPY public/ ./public/
COPY db/ ./db/

# Create data directory for SQLite (must match DB_PATH in .env)
RUN mkdir -p /app/data && chmod 755 /app/data

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server/index.js"]
