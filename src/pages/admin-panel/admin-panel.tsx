import { useEffect, useState } from 'react';
import { Localize, localize } from '@deriv-com/translations';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import tmApi from '@/utils/tm-api';
import './admin-panel.scss';

const AdminPanel = () => {
    const [balance, setBalance] = useState<number | null>(null);
    const [input_value, setInputValue] = useState('');
    const [is_loading, setIsLoading] = useState(true);
    const [is_saving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    const [sequence_value, setSequenceValue] = useState('');
    const [sequence_enabled, setSequenceEnabled] = useState(false);
    const [is_sequence_loading, setIsSequenceLoading] = useState(true);
    const [is_sequence_saving, setIsSequenceSaving] = useState(false);
    const [sequence_error, setSequenceError] = useState('');
    const [sequence_saved, setSequenceSaved] = useState(false);

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

        tmApi
            .getVirtualSequence()
            .then(s => {
                if (!is_mounted) return;
                setSequenceValue(s.sequence);
                setSequenceEnabled(s.enabled);
            })
            .catch(e => {
                if (!is_mounted) return;
                setSequenceError(e.message || 'Failed to load sequence');
            })
            .finally(() => {
                if (is_mounted) setIsSequenceLoading(false);
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
            globalObserver.emit('virtual_balance.update');
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e) {
            setError((e as Error).message || 'Failed to update virtual balance');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveSequence = async () => {
        const cleaned = sequence_value.toUpperCase().trim();
        if (cleaned && !/^[WL]+$/.test(cleaned)) {
            setSequenceError(localize("Sequence must only contain 'W' and 'L', e.g. WWWWL"));
            return;
        }
        setIsSequenceSaving(true);
        setSequenceError('');
        setSequenceSaved(false);
        try {
            const updated = await tmApi.setVirtualSequence({ sequence: cleaned, enabled: sequence_enabled });
            setSequenceValue(updated.sequence);
            setSequenceEnabled(updated.enabled);
            setSequenceSaved(true);
            setTimeout(() => setSequenceSaved(false), 3000);
        } catch (e) {
            setSequenceError((e as Error).message || 'Failed to update sequence');
        } finally {
            setIsSequenceSaving(false);
        }
    };

    const handleToggleSequence = async (next_enabled: boolean) => {
        setSequenceEnabled(next_enabled);
        setIsSequenceSaving(true);
        setSequenceError('');
        try {
            const updated = await tmApi.setVirtualSequence({ enabled: next_enabled });
            setSequenceEnabled(updated.enabled);
        } catch (e) {
            setSequenceError((e as Error).message || 'Failed to update sequence');
            setSequenceEnabled(!next_enabled);
        } finally {
            setIsSequenceSaving(false);
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

            <div className='admin-panel__section'>
                <h3>
                    <Localize i18n_default_text='Forced Win/Loss Sequence (Testing)' />
                </h3>
                <p className='admin-panel__hint'>
                    <Localize i18n_default_text="Force virtual trade outcomes to follow a pattern (e.g. WWWWL) instead of real market results — useful for testing bot recovery logic like Martingale. The pattern repeats once it reaches the end." />
                </p>

                {is_sequence_loading ? (
                    <p>
                        <Localize i18n_default_text='Loading...' />
                    </p>
                ) : (
                    <div className='admin-panel__balance-row'>
                        <input
                            type='text'
                            placeholder='WWWWL'
                            value={sequence_value}
                            onChange={e => setSequenceValue(e.target.value.toUpperCase())}
                            className='admin-panel__input'
                        />
                        <button onClick={handleSaveSequence} disabled={is_sequence_saving} className='admin-panel__save-btn'>
                            {is_sequence_saving ? <Localize i18n_default_text='Saving...' /> : <Localize i18n_default_text='Save Sequence' />}
                        </button>
                        <label className='admin-panel__toggle-label'>
                            <input
                                type='checkbox'
                                checked={sequence_enabled}
                                disabled={is_sequence_saving}
                                onChange={e => handleToggleSequence(e.target.checked)}
                            />
                            <Localize i18n_default_text='Enabled' />
                        </label>
                    </div>
                )}

                {sequence_error && <p className='admin-panel__error'>{sequence_error}</p>}
                {sequence_saved && (
                    <p className='admin-panel__success'>
                        <Localize i18n_default_text='Sequence updated.' />
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
