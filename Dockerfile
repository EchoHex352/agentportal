FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY server/ ./server/
COPY public/ ./public/
COPY db/ ./db/

# Create data directory for SQLite
RUN mkdir -p data

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server/index.js"]
