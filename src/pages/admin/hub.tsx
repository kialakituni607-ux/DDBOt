const links = [
    { href: '/admin/stats', title: 'Stats', desc: 'Users, logins, trades and commission (admin password)' },
    { href: '/admin/signals', title: 'Signals', desc: 'Post and manage trading signals' },
    { href: '/admin/trade', title: 'Admin Trade', desc: 'Admin trading page' },
    { href: '/', title: 'App Admin tab', desc: 'Log in as an admin account, then open the Admin tab in the tab bar (virtual balance controls)' },
];

const AdminHub = () => (
    <div style={{ maxWidth: 700, margin: '60px auto', padding: '0 16px' }}>
        <h2 style={{ marginBottom: 24 }}>Admin</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {links.map(l => (
                <a
                    key={l.href + l.title}
                    href={l.href}
                    style={{ display: 'block', background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 8px rgba(0,0,0,0.08)', textDecoration: 'none' }}
                >
                    <p style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#1a237e' }}>{l.title}</p>
                    <p style={{ margin: 0, fontSize: 13, color: '#666' }}>{l.desc}</p>
                </a>
            ))}
        </div>
    </div>
);

export default AdminHub;
