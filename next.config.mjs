/** @type {import('next').NextConfig} */
const nextConfig = {
  // The class notes guide is read when notes are written, so it ships with those routes.
  outputFileTracingIncludes: { "/api/lectures/**": ["./prompts/**/*.md"] },
};
export default nextConfig;
