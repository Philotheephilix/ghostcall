#[starknet::interface]
pub trait IStealthRegistry<TState> {
    fn register(
        ref self: TState,
        handle_hash: felt252,
        pk_v_x: felt252,
        pk_v_y: felt252,
        pk_s_x: felt252,
        pk_s_y: felt252,
    );
    fn get_stealth_meta(self: @TState, handle_hash: felt252) -> (felt252, felt252, felt252, felt252);
    fn is_registered(self: @TState, handle_hash: felt252) -> bool;
}

#[starknet::contract]
pub mod StealthRegistry {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        pk_v_x: Map<felt252, felt252>,
        pk_v_y: Map<felt252, felt252>,
        pk_s_x: Map<felt252, felt252>,
        pk_s_y: Map<felt252, felt252>,
        registered: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Registered: Registered,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Registered {
        #[key]
        pub handle_hash: felt252,
        pub pk_v_x: felt252,
        pub pk_v_y: felt252,
        pub pk_s_x: felt252,
        pub pk_s_y: felt252,
    }

    #[abi(embed_v0)]
    impl StealthRegistryImpl of super::IStealthRegistry<ContractState> {
        fn register(
            ref self: ContractState,
            handle_hash: felt252,
            pk_v_x: felt252,
            pk_v_y: felt252,
            pk_s_x: felt252,
            pk_s_y: felt252,
        ) {
            assert(!self.registered.read(handle_hash), 'handle already taken');
            self.pk_v_x.write(handle_hash, pk_v_x);
            self.pk_v_y.write(handle_hash, pk_v_y);
            self.pk_s_x.write(handle_hash, pk_s_x);
            self.pk_s_y.write(handle_hash, pk_s_y);
            self.registered.write(handle_hash, true);
            self.emit(Registered { handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y });
        }

        fn get_stealth_meta(
            self: @ContractState, handle_hash: felt252,
        ) -> (felt252, felt252, felt252, felt252) {
            assert(self.registered.read(handle_hash), 'handle not found');
            (
                self.pk_v_x.read(handle_hash),
                self.pk_v_y.read(handle_hash),
                self.pk_s_x.read(handle_hash),
                self.pk_s_y.read(handle_hash),
            )
        }

        fn is_registered(self: @ContractState, handle_hash: felt252) -> bool {
            self.registered.read(handle_hash)
        }
    }
}
