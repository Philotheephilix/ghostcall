#[starknet::interface]
pub trait ICallLog<TState> {
    fn commit_call(ref self: TState, commitment: felt252);
    fn is_committed(self: @TState, commitment: felt252) -> bool;
}

#[starknet::contract]
pub mod CallLog {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        commitments: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        CallCommitted: CallCommitted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CallCommitted {
        #[key]
        pub commitment: felt252,
    }

    #[abi(embed_v0)]
    impl CallLogImpl of super::ICallLog<ContractState> {
        fn commit_call(ref self: ContractState, commitment: felt252) {
            assert(!self.commitments.read(commitment), 'already committed');
            self.commitments.write(commitment, true);
            self.emit(CallCommitted { commitment });
        }

        fn is_committed(self: @ContractState, commitment: felt252) -> bool {
            self.commitments.read(commitment)
        }
    }
}
