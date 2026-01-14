import app from './server.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n🚀 SecureCaptcha SaaS Server running on http://localhost:${PORT}`);
    console.log(`Resource: http://localhost:${PORT}/api/v1/captcha/challenge`);
    console.log(`Health: http://localhost:${PORT}/health\n`);
});
