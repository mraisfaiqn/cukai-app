import {NavLink} from 'react-router-dom';

function UserNavigation(){
    return(
        <nav>
            <NavLink to="/profile" className={({isActive}) => isActive ? "active" : ""}>Profile & Entities</NavLink>
            <NavLink to="/team-access" className={({isActive}) => isActive ? "active" : ""}>Team Access</NavLink>
            <NavLink to="/notifications" className={({isActive}) => isActive ? "active" : ""}>Notifications</NavLink>
            <NavLink to="/language-display" className={({isActive}) => isActive ? "active" : ""}>Language & Display</NavLink>
        </nav>
        
    )
}

export default UserNavigation