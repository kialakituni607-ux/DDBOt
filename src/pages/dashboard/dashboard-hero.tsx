import './dashboard-hero.scss';

const FREE_BOTS_TAB = 5; // index of the Free Bots tab (see the hash list in main.tsx)

const QUOTES = [
    'Patience pays more often than speed.',
    'Protect your capital first; profits follow.',
    'A plan you follow beats a plan you abandon.',
    'Small, steady edges compound over time.',
    'Trade the setup, not the mood.',
    'Every loss is tuition. Review it, then move on.',
    'Discipline is the real strategy.',
];

const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
};

const DashboardHero = ({ handleTabChange }: { handleTabChange: (n: number) => void }) => {
    const quote = QUOTES[new Date().getDate() % QUOTES.length];
    return (
        <section className='tm-hero'>
            <svg className='tm-hero__bg' viewBox='0 0 800 300' preserveAspectRatio='xMidYMid slice' aria-hidden='true'>
                <path d='M0 220 C120 120 220 260 340 170 S560 90 800 150' fill='none' stroke='#3b82f6' strokeWidth='2' opacity='0.55' />
                <path d='M0 250 C140 170 260 290 400 200 S620 130 800 190' fill='none' stroke='#8b5cf6' strokeWidth='2' opacity='0.4' />
                {[560, 590, 620, 650, 680, 710, 740, 770].map((x, i) => {
                    const h = 30 + ((i * 37) % 70);
                    const up = i % 3 !== 1;
                    return (
                        <rect key={x} x={x} y={200 - h} width='14' height={h} fill={up ? '#10b981' : '#e11d48'} opacity='0.5' />
                    );
                })}
            </svg>
            <div className='tm-hero__inner'>
                <h1 className='tm-hero__greeting'>{getGreeting()}</h1>
                <p className='tm-hero__quote'>&ldquo;{quote}&rdquo;</p>
                <div className='tm-hero__label'>QUICK ACTIONS</div>
                <button type='button' className='tm-hero__card' onClick={() => handleTabChange(FREE_BOTS_TAB)}>
                    <span className='tm-hero__icon'>🤖</span>
                    <span className='tm-hero__title'>Free Bots</span>
                    <span className='tm-hero__desc'>Browse ready-made trading strategies</span>
                    <span className='tm-hero__link'>Explore bots ↗</span>
                </button>
            </div>
        </section>
    );
};

export default DashboardHero;
