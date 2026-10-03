# Probe

**A lightweight CLI for quickly checking whether a deployed HTTP service is alive.**

## The Problem

After deploying an application or API, developers often want to perform a quick sanity check before moving on.

They may want to know:

- Is the service reachable?
- Is it responding?
- Does it appear healthy?
- Did the deployment actually come up?

These checks are usually simple, but performing them manually can be repetitive. Full API testing tools can also be more than necessary when all you want is a quick post-deployment check.

## The Idea

**Probe** is a small command-line tool built around that simple workflow.

Give it a deployed service URL:

```bash
probe https://staging.example.com
```

Probe inspects the service and provides a concise summary of what it finds.

The central idea is:

> **Deploy → Probe → Know**

The tool should make it possible to perform a useful deployment sanity check without first creating a complete API test suite.

## Example

A possible interaction might look like:

```text
Probe

https://staging.example.com

✓ Service reachable
✓ HTTPS working
✓ Health check responding
✓ Response time: 42ms

Deployment looks healthy.
```

The exact checks, output, and behavior are intentionally left open for the project's specification and design process.

## Target User

Probe is intended for developers who want a fast way to sanity-check an HTTP service, particularly after:

- Deploying a new version
- Updating a staging environment
- Changing server configuration
- Starting a local service
- Completing a deployment in CI

## Scope

Probe should remain a **small and focused developer utility**.

It is not intended to become a replacement for:

- Full API testing frameworks
- Load-testing tools
- Monitoring platforms
- Observability systems
- Browser testing frameworks

The project should focus on the narrow problem of **quickly determining whether an HTTP service appears to be alive after deployment**.

## Tech Stack

The project is intended to use a lightweight TypeScript-based CLI stack:

- **TypeScript** — primary language
- **Node.js** — runtime
- **Commander.js** — CLI argument handling
- **undici** — HTTP client
- **Chalk** and **ora** — terminal output
- **Vitest** — testing
- **tsup** — build tooling
- **pnpm** — package manager
- **GitHub Actions** — CI

The stack is intentionally lightweight. Avoid introducing additional infrastructure or frameworks unless there is a clear reason to do so.

## Project Goal

Build a small, polished developer tool around this concept.

The specific feature set, technical implementation, CLI experience, output format, and branding should be determined during the project's specification and design phases rather than being dictated by this README.

## Project Philosophy

Probe is a throwaway-sized project: small enough to build quickly, but polished enough to be useful and presentable.

Prioritize:

- A clear purpose
- A simple user experience
- Useful results
- Sensible scope
- A finished, coherent project

Avoid adding complexity simply to increase the feature count.
