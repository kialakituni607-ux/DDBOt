import { derivLogin } from '@/utils/deriv-auth-adapter';

export const useLoginChoice = () => {
    const triggerLogin = () => {
        derivLogin();
    };
    const modal = null;
    return { triggerLogin, modal };
};

export default useLoginChoice;
