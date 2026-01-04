FROM node:18-bullseye

# Set working directory
WORKDIR /app

# Install build tools needed for swisseph
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Build the app (Next.js)
RUN npm run build

# Runtime environment
ENV NODE_ENV=production
ENV PORT=3000

# Railway will route to this port
EXPOSE 3000

# Start the app
CMD ["npm", "run", "start"]