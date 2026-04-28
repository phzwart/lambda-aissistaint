# AISSIStaint UI

Workflow-driven React front end for secure LLM setup, document processing, knowledge review, and grounded Q&A.

## Stack

- Vite
- React
- TypeScript
- Material UI v5
- React Router
- Zustand

## Run

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` when Podman service URLs are ready. The current implementation uses mock services by default while preserving service-layer boundaries for Keycloak, OpenBao, MinIO, and backend agent APIs.
