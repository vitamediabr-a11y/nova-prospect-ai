import "dotenv/config";

const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;

if (!email || !password) {
  throw new Error("Defina OWNER_EMAIL e OWNER_PASSWORD antes de criar o usuário OWNER.");
}
if (password.length < 12) {
  throw new Error("OWNER_PASSWORD deve ter pelo menos 12 caracteres.");
}

process.env.ALLOW_SIGNUP = "true";

const [{ auth }, { prisma }] = await Promise.all([import("../src/lib/auth"), import("../src/lib/prisma")]);
const existing = await prisma.user.findUnique({ where: { email } });

if (existing) {
  throw new Error("Já existe um usuário com este e-mail.");
}

const created = await auth.api.signUpEmail({ body: { name: "Owner", email, password } });
await prisma.user.update({ where: { id: created.user.id }, data: { role: "OWNER", emailVerified: true } });
console.log(`OWNER criado: ${email}`);
await prisma.$disconnect();
