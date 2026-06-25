import React from 'react';
import './dtrader.scss';

const DTrader = () => {
    return (
        <div className='dtrader-page'>
            <iframe
                src='https://dtrader.deriv.com'
                className='dtrader-iframe'
                title='Deriv Trader'
                allow='camera; microphone'
            />
        </div>
    );
};

export default DTrader;
