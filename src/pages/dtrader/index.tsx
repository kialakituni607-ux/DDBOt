import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import './dtrader.scss';

const SYMBOLS = [
    { label: 'Volatility 100 (1s) Index', value: '1HZ100V' },
    { label: 'Volatility 75 (1s) Index', value: '1HZ75V' },
    { label: 'Volatility 50 (1s) Index', value: '1HZ50V' },
    { label: 'Volatility 25 (1s) Index', value: '1HZ25V' },
    { label: 'Volatility 10 (1s) Index', value: '1HZ10V' },
    { label: 'Volatility 100 Index', value: 'R_100' },
    { label: 'Volatility 75 Index', value: 'R_75' },
    { label: 'Volatility 50 Index', value: 'R_50' },
    { label: 'Volatility 25 Index', value: 'R_25' },
    { label: 'Volatility 10 Index', value: 'R_10' },
];

const TRADE_TYPES = [
    { label: 'Rise/Fall', choices: ['Rise', 'Fall'], hasDigit: false },
    { label: 'Higher/Lower', choices: ['Higher', 'Lower'], hasDigit: false },
    { label: 'Matches/Differs', choices: ['Matches', 'Differs'], hasDigit: true },
    { label: 'Over/Under', choices: ['Over', 'Under'], hasDigit: true },
    { label: 'Even/Odd', choices: ['Even', 'Odd'], hasDigit: true },
    { label: 'Accumulators', choices: ['Accumulate'], hasDigit: false },
    { label: 'Multipliers', choices: ['Up', 'Down'], hasDigit: false },
    { label: 'Touch/No Touch', choices: ['Touch', 'No Touch'], hasDigit: false },
    { label: 'Vanillas', choices: ['Call', 'Put'], hasDigit: false },
    { label: 'Turbos', choices: ['Long', 'Short'], hasDigit: false },
];

const CM: any = {
    'Rise/Fall': { Rise: 'CALL', Fall: 'PUT' },
    'Higher/Lower': { Higher: 'CALL', Lower: 'PUT' },
    'Matches/Differs': { Matches: 'DIGITMATCH', Differs: 'DIGITDIFF' },
    'Over/Under': { Over: 'DIGITOVER', Under: 'DIGITUNDER' },
    'Even/Odd': { Even: 'DIGITEVEN', Odd: 'DIGITODD' },
    'Accumulators': { Accumulate: 'ACCU' },
    'Multipliers': { Up: 'MULTUP', Down: 'MULTDOWN' },
    'Touch/No Touch': { Touch: 'ONETOUCH', 'No Touch': 'NOTOUCH' },
    'Vanillas': { Call: 'VANILLALONGCALL', Put: 'VANILLALONGPUT' },
    'Turbos': { Long: 'TURBOSLONG', Short: 'TURBOSSHORT' },
};

const DTrader = () => {
    const [symbol, setSymbol] = React.useState('1HZ100V');
    const [symbolLabel, setSymbolLabel] = React.useState('Volatility 100 (1s) Index');
    const [activeTab, setActiveTab] = React.useState(0);
    const [activeChoice, setActiveChoice] = React.useState(0);
    const [digit, setDigit] = React.useState(5);
    const [duration, setDuration] = React.useState(5);
    const [durationUnit, setDurationUnit] = React.useState('t');
    const [stake, setStake] = React.useState(10);
    const [payout, setPayout] = React.useState(null);
    const [price, setPrice] = React.useState(null);
    const [digitStats, setDigitStats] = React.useState(Array(10).fill(0));
    const [buying, setBuying] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const svgRef = React.useRef(null);
    const priceHistory = React.useRef([]);
    const tickSub = React.useRef(null);
    const proposalSub = React.useRef(null);
    const proposalId = React.useRef(null);

    const drawChart = React.useCallback((prices) => {
        const svg = svgRef.current;
        const w = svg.clientWidth || 700;
        const h = svg.clientHeight || 400;
        const min = Math.min(...prices) - 0.5;
        const max = Math.max(...prices) + 0.5;
        const xs = w / (prices.length - 1);
        const ys = h / (max - min);
        const path = prices.map((p, i) => (i ? 'L' : 'M') + (i * xs).toFixed(1) + ',' + (h - (p - min) * ys).toFixed(1)).join(' ');
        const lx = (prices.length - 1) * xs;
        const ly = h - (prices[prices.length - 1] - min) * ys;
        const up = prices[prices.length - 1] >= prices[prices.length - 2];
        const col = up ? '#4cd964' : '#e74c3c';
        svg.innerHTML = '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + col + '" stop-opacity="0.25"/><stop offset="100%" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs><path d="' + path + ' L' + lx + ',' + h + ' L0,' + h + ' Z" fill="url(#g)"/><path d="' + path + '" fill="none" stroke="' + col + '" stroke-width="1.5"/><circle cx="' + lx + '" cy="' + ly + '" r="4" fill="' + col + '"/>';
    }, []);

    const subscribeTicks = React.useCallback((sym) => {
        if (tickSub.current) tickSub.current.unsubscribe && tickSub.current.unsubscribe();
        priceHistory.current = [];
        setDigitStats(Array(10).fill(0));
        const digits = [];
        tickSub.current = api_base.api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'tick' && data.tick && data.tick.symbol === sym) {
                const p = parseFloat(data.tick.quote);
                setPrice(p);
                priceHistory.current = [...priceHistory.current.slice(-79), p];
                drawChart(priceHistory.current);
                const lastDigit = parseInt(Number(data.tick.quote).toFixed(api_base.pip_sizes && api_base.pip_sizes[sym] !== undefined ? api_base.pip_sizes[sym] : 2).slice(-1));
                digits.push(lastDigit);
                if (digits.length > 1000) digits.shift();
                const stats = Array(10).fill(0);
                digits.forEach(d => stats[d]++);
                setDigitStats(stats.map(s => parseFloat(((s / digits.length) * 100).toFixed(1))));
            }
        });
        api_base.api.send({ ticks: sym, subscribe: 1 });
        api_base.api.send({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' }).then((res) => {
            if (res && res.history && res.history.prices) {
                const prices = res.history.prices;
                prices.forEach((p) => {
                    const d = parseInt(Number(p).toFixed(api_base.pip_sizes && api_base.pip_sizes[sym] !== undefined ? api_base.pip_sizes[sym] : 2).slice(-1));
                    digits.push(d);
                });
                if (digits.length > 1000) digits.splice(0, digits.length - 1000);
                const stats = Array(10).fill(0);
                digits.forEach(d => stats[d]++);
                setDigitStats(stats.map(s => parseFloat(((s / digits.length) * 100).toFixed(1))));
            }
        }).catch(() => {});
    }, [drawChart]);

    const getProposal = React.useCallback(() => {
        if (proposalSub.current) proposalSub.current.unsubscribe && proposalSub.current.unsubscribe();
        proposalId.current = null;
        setPayout(null);
        const tradeType = TRADE_TYPES[activeTab];
        const choice = tradeType.choices[activeChoice];
        const contractType = CM[tradeType.label] && CM[tradeType.label][choice];
        const proposal = { proposal: 1, subscribe: 1, amount: stake, basis: 'stake', contract_type: contractType, currency: 'USD', duration: duration, duration_unit: durationUnit };
        proposal.symbol = symbol;
        if (tradeType.hasDigit) { proposal.barrier = digit; }
        proposalSub.current = api_base.api.onMessage().subscribe(({ data }) => {
            if (data.msg_type === 'proposal' && data.proposal) {
                setPayout(parseFloat(data.proposal.payout));
                proposalId.current = data.proposal.id;
            }
        });
        api_base.api.send(proposal);
    }, [activeTab, activeChoice, symbol, stake, duration, durationUnit, digit]);

    React.useEffect(() => { if (api_base.api) subscribeTicks(symbol); }, [symbol]);
    React.useEffect(() => { if (api_base.api) getProposal(); }, [activeTab, activeChoice, symbol, stake, duration, durationUnit, digit]);

    const handleBuy = async () => {
        console.log('BUY CLICKED'); setBuying(true); setMessage('');
        try {
            const res = await api_base.api.send({ buy: proposalId.current, price: stake }); console.log('BUY RESPONSE', res);
            if (res.buy) { setMessage('Bought! Contract: ' + res.buy.contract_id); }
            else if (res.error) { setMessage('Error: ' + res.error.message); }
        } catch(e) { console.log('BUY ERROR RAW', e); setMessage('Error: ' + e.message); }
        setBuying(false);
        setTimeout(() => setMessage(''), 5000);
    };

    const tradeType = TRADE_TYPES[activeTab];

    return (
        <div className='dtrader-page'>
            <div className='dtrader-tabs'>
                {TRADE_TYPES.map((t, i) => (
                    <div key={t.label} className={'dtrader-tab' + (activeTab === i ? ' active' : '')} onClick={() => { setActiveTab(i); setActiveChoice(0); }}>{t.label}</div>
                ))}
            </div>
            <div className='dtrader-body'>
                <div className='dtrader-left'>
                    <div className='dtrader-market-bar'>
                        <div><div className='dtrader-mname'>{symbolLabel}</div><div className='dtrader-mprice'>{price ? price.toFixed(2) : '---'}</div></div>
                        <select className='dtrader-select' value={symbol} onChange={e => { setSymbol(e.target.value); setSymbolLabel(SYMBOLS.find(s => s.value === e.target.value)?.label ?? ''); }}>
                            {SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </div>
                    <div className='dtrader-chart-area'><svg ref={svgRef} className='dtrader-svg' />{price && <div className='dtrader-ptag'>{price.toFixed(2)}</div>}</div>
                </div>
                <div className='dtrader-form'>
                    <div className='dtrader-form-title'>How to trade {tradeType.label}?</div>
                    <div className={'dtrader-choices' + (tradeType.choices.length === 1 ? ' single' : '')}>
                        {tradeType.choices.map((ch, i) => (<div key={ch} className={'dtrader-choice' + (activeChoice === i ? ' active' : '')} onClick={() => setActiveChoice(i)}>{ch}</div>))}
                    </div>
                    {tradeType.hasDigit && <div className='dtrader-digits'><div className='dtrader-digits-label'>Last digit prediction</div><div className='dtrader-digit-grid'>{Array.from({length:10},(_,i)=>(<div key={i} className={'dtrader-digit'+(digit===i?' active':'')} onClick={()=>setDigit(i)}><span className='dtrader-digit-num'>{i}</span><span className={'dtrader-digit-pct'+(digitStats[i]&&digitStats[i]===Math.min(...digitStats.filter(Boolean))?' hot':'')}>{(digitStats[i]||0)+'%'}</span></div>))}</div></div>}
                    <div className='dtrader-field'><div className='dtrader-field-label'>Duration</div><div className='dtrader-field-row'><input className='dtrader-input' type='number' value={duration} min={1} onChange={e=>setDuration(Number(e.target.value))} style={{width:60}} /><select className='dtrader-input' value={durationUnit} onChange={e=>setDurationUnit(e.target.value)}><option value='t'>ticks</option><option value='s'>seconds</option><option value='m'>minutes</option><option value='h'>hours</option><option value='d'>days</option></select></div></div>
                    <div className='dtrader-field'><div className='dtrader-field-label'>Stake</div><div className='dtrader-field-row'><input className='dtrader-input' type='number' value={stake} min={0.35} step={0.01} onChange={e=>setStake(Number(e.target.value))} /><span className='dtrader-currency'>USD</span></div></div>
                    {message && <div className='dtrader-message'>{message}</div>}
                    <button className='dtrader-buy-btn' onClick={handleBuy} disabled={buying || !proposalId.current}><div>{buying ? 'Buying...' : 'Buy'}</div><div className='dtrader-buy-sub'>Payout {payout ? payout.toFixed(2) : '---'} USD</div></button>
                </div>
            </div>
        </div>
    );
};

export default observer(DTrader);
