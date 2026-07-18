/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Esto ignora los errores de TypeScript durante el build
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig