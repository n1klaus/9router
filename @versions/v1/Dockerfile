FROM public.ecr.aws/d3j8x8q7/olympus-base-typescript:latest
WORKDIR /app

# vitest is a tests/-subtree devDep with an untracked lockfile; vendor it at root so
# the offline platform clone has the runner. --include=dev overrides the image's
# NODE_ENV=production (npm omits dev deps by default there).
COPY package.json ./
RUN npm install --include=dev --save-dev --package-lock-only vitest@4.1.11 --no-audit --no-fund \
 && npm ci --include=dev --no-audit --no-fund

COPY . .
CMD ["/bin/bash"]
