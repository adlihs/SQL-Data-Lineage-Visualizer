
import React from 'react';

export const DBTIcon: React.FC<{className: string}> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#F97316"/>
        <path d="M12 7V17M12 17L16 13.5M12 17L8 13.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);


export const PostgreSQLIcon: React.FC<{className: string}> = ({ className }) => (
     <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z" fill="#336791"/>
        <path d="M12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4V20Z" fill="#FFF"/>
        <path d="M15.5 16H12V18H15.5C16.88 18 18 16.88 18 15.5V8.5C18 7.12 16.88 6 15.5 6H12V14H15C15.83 14 16.5 13.33 16.5 12.5V11.5C16.5 10.67 15.83 10 15 10H12V8H15.5C16.33 8 17 8.67 17 9.5V14.5C17 15.33 16.33 16 15.5 16Z" fill="#336791"/>
    </svg>
);
