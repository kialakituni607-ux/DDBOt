import { useEffect, useState } from 'react';
import { Localize, localize } from '@deriv-com/translations';
import tmApi from '@/utils/tm-api';
import './admin-panel.scss';

const AdminPanel = () => {
    const [balance, setBalance] = useState<number | null>(null);
    const [input_value, setInputValue] = useState('');
    const [is_loading, setIsLoading] = useState(true);
    const [is_saving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let is_mounted = true;
        tmApi
            .getVirtualBalance()
            .then(b => {
                if (!is_mounted) return;
                setBalance(b);
                setInputValue(String(b));
            })
            .catch(e => {
                if (!is_mounted) return;
                setError(e.message || 'Failed to load virtual balance');
            })
            .finally(() => {
                if (is_mounted) setIsLoading(false);
            });
        return () => {
            is_mounted = false;
        };
    }, []);

    const handleSave = async () => {
        const parsed = parseFloat(input_value);
        if (isNaN(parsed) || parsed < 0) {
            setError(localize('Enter a valid, non-negative number'));
            return;
        }
        setIsSaving(true);
        setError('');
        setSaved(false);
        try {
            const updated = await tmApi.setVirtualBalance(parsed);
            setBalance(updated);
            setInputValue(String(updated));
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e) {
            setError((e as Error).message || 'Failed to update virtual balance');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className='admin-panel'>
            <h2>
                <Localize i18n_default_text='Admin' />
            </h2>

            <div className='admin-panel__section'>
                <h3>
                    <Localize i18n_default_text='Virtual Trading Balance' />
                </h3>
                <p className='admin-panel__hint'>
                    <Localize i18n_default_text='Set your simulated balance for paper trading. Real market prices and outcomes are used, but no real money is involved.' />
                </p>

                {is_loading ? (
                    <p>
                        <Localize i18n_default_text='Loading...' />
                    </p>
                ) : (
                    <div className='admin-panel__balance-row'>
                        <span className='admin-panel__current-balance'>
                            <Localize i18n_default_text='Current: {{balance}} USD' values={{ balance: balance ?? 0 }} />
                        </span>
                        <input
                            type='number'
                            min='0'
                            step='0.01'
                            value={input_value}
                            onChange={e => setInputValue(e.target.value)}
                            className='admin-panel__input'
                        />
                        <button onClick={handleSave} disabled={is_saving} className='admin-panel__save-btn'>
                            {is_saving ? <Localize i18n_default_text='Saving...' /> : <Localize i18n_default_text='Set Balance' />}
                        </button>
                    </div>
                )}

                {error && <p className='admin-panel__error'>{error}</p>}
                {saved && (
                    <p className='admin-panel__success'>
                        <Localize i18n_default_text='Balance updated.' />
                    </p>
                )}
            </div>

            <p className='admin-panel__hint'>
                <Localize i18n_default_text='More admin features coming soon.' />
            </p>
        </div>
    );
};

export default AdminPanel;
