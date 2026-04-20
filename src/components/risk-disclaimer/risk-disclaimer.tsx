import React, { useState } from 'react';
import './risk-disclaimer.scss';

const RiskDisclaimer = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button className='risk-disclaimer__trigger' onClick={() => setOpen(true)}>
                ⚠ Risk Disclaimer
            </button>

            {open && (
                <div className='risk-disclaimer__overlay' onClick={() => setOpen(false)}>
                    <div className='risk-disclaimer__modal' onClick={e => e.stopPropagation()}>
                        <h2 className='risk-disclaimer__title'>Risk Disclaimer</h2>
                        <div className='risk-disclaimer__body'>
                            <p>
                                Deriv offers complex derivatives, such as options and contracts for difference
                                (&ldquo;CFDs&rdquo;). These products may not be suitable for all clients, and trading
                                them puts you at risk. Please make sure that you understand the following risks before
                                trading Deriv products:
                            </p>
                            <ul>
                                <li>You may lose some or all of the money you invest in the trade.</li>
                                <li>
                                    If your trade involves currency conversion, exchange rates will affect your profit
                                    and loss.
                                </li>
                                <li>
                                    You should never trade with borrowed money or with money that you cannot afford to
                                    lose.
                                </li>
                            </ul>
                        </div>
                        <button className='risk-disclaimer__close' onClick={() => setOpen(false)}>
                            Close
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default RiskDisclaimer;
