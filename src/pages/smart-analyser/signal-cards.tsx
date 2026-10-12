import { useState } from 'react';
import './signal-cards.scss';

type Tone = 'green' | 'red' | 'purple' | 'amber' | 'grey';
type Result = { c: string; word: string; tone: Tone };
type SideDef = { name: string; word: string; tone: Tone };
type Picker = { selected: number; latest: number | null; onPick: (d: number) => void };

const MAX_COLLAPSED = 10;
const MAX_EXPANDED = 56;

const streakText = (results: Result[]) => {
    if (!results.length) return '';
    let n = 1;
    while (n < results.length && results[n].word === results[0].word) n++;
    return `${n}x ${results[0].word}`;
};

const Card = ({ title, results, sides, picker }: { title: string; results: Result[]; sides: SideDef[]; picker?: Picker }) => {
    const [expanded, setExpanded] = useState(false);
    const shown = results.slice(0, expanded ? MAX_EXPANDED : MAX_COLLAPSED);
    return (
        <div className='sc-card'>
            <div className='sc-card__head'>
                <span className='sc-card__title'>{title}</span>
                <span className='sc-card__streak'>{streakText(results)}</span>
            </div>
            {picker && (
                <div className='sc-digits'>
                    {Array.from({ length: 10 }, (_, d) => (
                        <button
                            key={d}
                            type='button'
                            className={`sc-digit ${picker.selected === d ? 'sc-digit--selected' : ''} ${
                                picker.latest === d ? 'sc-digit--latest' : ''
                            }`}
                            onClick={() => picker.onPick(d)}
                        >
                            {d}
                        </button>
                    ))}
                </div>
            )}
            {sides.map(s => {
                const p = results.length ? (results.filter(r => r.word === s.word).length / results.length) * 100 : 0;
                return (
                    <div key={s.word} className='sc-bar'>
                        <span className={`sc-bar__name sc-tone--${s.tone}`}>{s.name}</span>
                        <div className='sc-bar__track'>
                            <div className={`sc-bar__fill sc-bg--${s.tone}`} style={{ width: `${p}%` }} />
                        </div>
                        <span className={`sc-bar__pct sc-tone--${s.tone}`}>{p.toFixed(1)}%</span>
                    </div>
                );
            })}
            <div className='sc-chips'>
                {shown.map((r, i) => (
                    <span key={i} className={`sc-chip sc-chip--${r.tone}`}>
                        {r.c}
                    </span>
                ))}
                {results.length > MAX_COLLAPSED && (
                    <button type='button' className='sc-more' onClick={() => setExpanded(e => !e)}>
                        {expanded ? '− Less' : '+ More'}
                    </button>
                )}
            </div>
        </div>
    );
};

type Props = { digits: number[]; prices: number[]; sampleSize: number; lastDigit: number | null };

const SignalCards = ({ digits, prices, sampleSize, lastDigit }: Props) => {
    const [barrier, setBarrier] = useState(3);
    const [predDigit, setPredDigit] = useState(3);

    const win = digits.slice(-sampleSize).reverse(); // newest first

    if (win.length < 25) {
        return (
            <div className='sc-wrap'>
                <div className='sc-loading'>Gathering enough ticks to show signals...</div>
            </div>
        );
    }

    const overUnder: Result[] = win.map(d =>
        d > barrier
            ? { c: 'O', word: 'Over', tone: 'green' }
            : d < barrier
              ? { c: 'U', word: 'Under', tone: 'red' }
              : { c: '=', word: 'Equal', tone: 'grey' }
    );
    const evenOdd: Result[] = win.map(d =>
        d % 2 === 0 ? { c: 'E', word: 'Even', tone: 'green' } : { c: 'O', word: 'Odd', tone: 'red' }
    );
    const matchDiffer: Result[] = win.map(d =>
        d === predDigit ? { c: 'M', word: 'Match', tone: 'amber' } : { c: 'D', word: 'Differ', tone: 'purple' }
    );

    const pw = prices.slice(-(sampleSize + 1));
    const riseFall: Result[] = [];
    for (let i = pw.length - 1; i > 0; i--) {
        if (pw[i] > pw[i - 1]) riseFall.push({ c: 'R', word: 'Rise', tone: 'green' });
        else if (pw[i] < pw[i - 1]) riseFall.push({ c: 'F', word: 'Fall', tone: 'red' });
    }

    return (
        <div className='sc-wrap'>
            <div className='sc-title'>Trade Signals</div>
            <div className='sc-grid'>
                <Card
                    title='OVER / UNDER'
                    results={overUnder}
                    sides={[
                        { name: 'OVER', word: 'Over', tone: 'green' },
                        { name: 'UNDER', word: 'Under', tone: 'amber' },
                    ]}
                    picker={{ selected: barrier, latest: lastDigit, onPick: setBarrier }}
                />
                <Card
                    title='MATCH / DIFFER'
                    results={matchDiffer}
                    sides={[
                        { name: 'MATCH', word: 'Match', tone: 'amber' },
                        { name: 'DIFFER', word: 'Differ', tone: 'purple' },
                    ]}
                    picker={{ selected: predDigit, latest: lastDigit, onPick: setPredDigit }}
                />
                <Card
                    title='EVEN / ODD'
                    results={evenOdd}
                    sides={[
                        { name: 'EVEN', word: 'Even', tone: 'red' },
                        { name: 'ODD', word: 'Odd', tone: 'red' },
                    ]}
                />
                <Card
                    title='RISE / FALL'
                    results={riseFall}
                    sides={[
                        { name: 'RISE', word: 'Rise', tone: 'green' },
                        { name: 'FALL', word: 'Fall', tone: 'red' },
                    ]}
                />
            </div>
        </div>
    );
};

export default SignalCards;
