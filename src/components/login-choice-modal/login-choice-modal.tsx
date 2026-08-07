import { redirectToLegacyLogin } from '@/utils/deriv-auth-adapter';

export const useLoginChoice = () => {
    const triggerLogin = () => {
        redirectToLegacyLogin();
    };
    const modal = null;
    return { triggerLogin, modal };
};

export default useLoginChoice;
