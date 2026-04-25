export default function handler(_req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(403).json({
        error: 'Forbidden',
        message: 'Bot file access is blocked.',
    });
}
