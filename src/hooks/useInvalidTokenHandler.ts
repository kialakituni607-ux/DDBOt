import { useEffect } from 'react';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { loginWithFallback } from '@/utils/auth-utils';

export const useInvalidTokenHandler = (): { unregisterHandler: () => void } => {
    const handleInvalidToken = () => {
        loginWithFallback();
    };

    useEffect(() => {
        globalObserver.register('InvalidToken', handleInvalidToken);
        return () => {
            globalObserver.unregister('InvalidToken', handleInvalidToken);
        };
    }, []);

    return {
        unregisterHandler: () => {
            globalObserver.unregister('InvalidToken', handleInvalidToken);
        },
    };
};

export default useInvalidTokenHandler;
