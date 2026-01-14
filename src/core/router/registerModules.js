import captchaRoutes from '../../modules/captcha/captcha.routes.js';

// In a larger system, this could auto-load from directories
export const registerModules = (app) => {
    app.use('/api/v1/captcha', captchaRoutes);
};
