export interface ContractInfo {
    name: string;
    address: string;
    deploymentBlock: string | number;
    entrypoints: string[];
}

export interface BalanceMap {
    [level: number]: {
        balance: string | number
    }
}

export interface Swap {
    hash: string,
    operator: string,
    input: 'coin' | 'token',
    amount: string | number
}

export interface Liquidity {
    hash: string,
    operator: string,
    coinAmount: string | number,
    tokenAmount: string | number
}

// export type OperationInfo: ;

export interface OperationMap {
    [level: number]: (Swap | Liquidity)[];
}

export interface ChainHistory {
    [contract: string]: {
        [level: number]: {
            timestamp: string,
            price: number,
            coinBalance: number | string,
            internalCoinBalance?: string | number,
            tokenBalance: number | string,
            totalSupply: number | string,
            operations: {
                [hash: string]:
                {
                    receiver: string,
                    input: 'coin' | 'token',
                    amount: string | number
                }
            }
        }
    }
}
