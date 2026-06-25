import React, { useEffect, useState } from 'react';
import { redirectToLegacyLogin, derivLogin } from '@/utils/deriv-auth-adapter';
import './login-choice-modal.scss';

const LOGIN_CHOICE_KEY = 'login_flow_choice';

const LoginChoiceModal = ({ onClose }: { onClose: () => void }) => {
    const handleNewAPI = () => {
        localStorage.setItem(LOGIN_CHOICE_KEY, 'pkce');
        onClose();
        derivLogin();
    };
    const handleLegacy = () => {
        localStorage.setItem(LOGIN_CHOICE_KEY, 'legacy');
        onClose();
        redirectToLegacyLogin();
    };
    return (
        <div className='login-choice-modal__overlay'>
            <div className='login-choice-modal'>
                <h2 className='login-choice-modal__title'>Choose Login Method</h2>
                <p className='login-choice-modal__desc'>Which type of Deriv account do you have?</p>
                <div className='login-choice-modal__buttons'>
                    <button className='login-choice-modal__btn login-choice-modal__btn--new' onClick={handleNewAPI}>
                        <span className='login-choice-modal__btn-title'>New Deriv API</span>
                        <span className='login-choice-modal__btn-desc'>Recently created account</span>
                    </button>
                    <button className='login-choice-modal__btn login-choice-modal__btn--legacy' onClick={handleLegacy}>
                        <span className='login-choice-modal__btn-title'>Existing Deriv Account</span>
                        <span className='login-choice-modal__btn-desc'>Classic Deriv account</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export const useLoginChoice = () => {
    const [showModal, setShowModal] = useState(false);

    const triggerLogin = () => {
        const saved = localStorage.getItem(LOGIN_CHOICE_KEY);
        if (saved === 'pkce') {
            derivLogin();
        } else if (saved === 'legacy') {
            redirectToLegacyLogin();
        } else {
            setShowModal(true);
        }
    };

    const modal = showModal ? <LoginChoiceModal onClose={() => setShowModal(false)} /> : null;

    return { triggerLogin, modal };
};

export default LoginChoiceModal;
