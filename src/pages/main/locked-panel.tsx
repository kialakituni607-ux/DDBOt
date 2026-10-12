import { useLoginChoice } from '@/components/login-choice-modal/login-choice-modal';
import './locked-panel.scss';

const LockedPanel = () => {
    const { triggerLogin, modal } = useLoginChoice();
    return (
        <div className='tm-locked'>
            <div className='tm-locked__card'>
                <div className='tm-locked__icon'>🔒</div>
                <div className='tm-locked__pill'>RESTRICTED ACCESS</div>
                <h2 className='tm-locked__title'>Welcome back.</h2>
                <p className='tm-locked__text'>Log in to your Deriv account to unlock this trading tool.</p>
                <button type='button' className='tm-locked__btn' onClick={() => triggerLogin()}>
                    LOG IN TO CONTINUE →
                </button>
                <div className='tm-locked__feats'>
                    <span>Secure access</span>
                    <span>Real-time sync</span>
                    <span>Pro analytics</span>
                </div>
            </div>
            {modal}
        </div>
    );
};

export default LockedPanel;
