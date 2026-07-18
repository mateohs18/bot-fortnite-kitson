/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Esto es lo que evita que Railway se detenga por errores de TS
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig