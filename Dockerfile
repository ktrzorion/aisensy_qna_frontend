# Use the official nginx image as a parent image
FROM nginx:alpine

# Copy the index.html file from your local machine to the container
# This assumes index.html is in the same directory as your Dockerfile
COPY index.html /usr/share/nginx/html/

# Nginx runs on port 80 by default, so we expose that port
EXPOSE 80

# When the container starts, nginx will start automatically