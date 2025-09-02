# Purpose

Move current cloudflare container setup to Daytona

## Requirements

- We need to move current cloudflare container setup to Daytona.

- [Current Daytona documentation](https://www.daytona.io/docs/llms-full.txt)

- We need to use the same container as we have but try with slim version.

- The internals of container doesn't change, but it changes with how cloudflare workers are setup with and interact with Daytona.

- Use [this repo](https://github.com/ghostwriternr/nightona) as an inspiration, This uses almost same setup (Worker as access point, daytona as sandbox) but with a significantly different purpose.

