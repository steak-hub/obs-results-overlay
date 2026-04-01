# Use a official Node.js runtime as a parent image
FROM node:18-slim

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure both package.json AND package-lock.json are copied.
COPY package*.json ./

# Install production dependencies.
RUN npm install --only=production

# Copy local code to the container image.
COPY . .

# Service listens on port 8080.
EXPOSE 8080

# Run the web service on container startup.
CMD [ "npm", "start" ]
